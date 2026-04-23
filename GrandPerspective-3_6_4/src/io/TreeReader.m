/* GrandPerspective, Version 3.6.4 
 *   A utility for macOS that graphically shows disk usage. 
 * Copyright (C) 2005-2025, Erwin Bonsma 
 * 
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU General Public License as published by the Free 
 * Software Foundation; either version 2 of the License, or (at your option) 
 * any later version. 
 * 
 * This program is distributed in the hope that it will be useful, but WITHOUT 
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or 
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for 
 * more details. 
 * 
 * You should have received a copy of the GNU General Public License along 
 * with this program; if not, write to the Free Software Foundation, Inc., 
 * 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA. 
 */

#import "TreeReader.h"

#import "TreeContext.h"
#import "AnnotatedTreeContext.h"
#import "DirectoryItem.h"
#import "PlainFileItem.h"
#import "CompoundItem.h"
#import "ScanTreeRoot.h"

#import "Filter.h"
#import "NamedFilter.h"
#import "FilterSet.h"
#import "FilterTestRef.h"
#import "FilterTestRepository.h"

#import "TreeBuilder.h"
#import "TreeBalancer.h"
#import "XmlTreeWriter.h"
#import "CompressedInput.h"
#import "InputStreamAdapter.h"

#import "ReadProgressTracker.h"

#import "UniformTypeInventory.h"
#import "ApplicationError.h"


NSString  *AttributeNameKey = @"name";

static const int AUTORELEASE_PERIOD = 1024;

// Localized error messages
#define PARSE_ERROR_MSG \
  NSLocalizedString(@"Parse error (line %d): %@", @"Parse error")
#define ATTR_PARSE_ERROR_MSG \
  NSLocalizedString(@"Error parsing \"%@\" attribute: %@", @"Parse error")

#define EXPECTED_ELEM_MSG \
  NSLocalizedString(@"Expected %@ element", @"Parse error")

#define MULTIPLE_ELEM_MSG \
  NSLocalizedString(@"Encountered multiple %@ elements", @"Parse error")
#define MULTIPLE_ROOT_ELEM_MSG \
  NSLocalizedString(@"Encountered more than one root element", @"Parse error")
#define MULTIPLE_ROOT_FOLDER_MSG \
  NSLocalizedString(@"Encountered more than one root folder", @"Parse error")
#define FILTER_AFTER_FOLDER_MSG \
  NSLocalizedString(@"Encountered filter after folder", @"Parse error")
#define NO_TREE_ERROR_MSG \
  NSLocalizedString(@"Failed to read any tree data", @"Parse error")

#define PARSING_ABORTED_MSG \
  NSLocalizedString(@"Parsing aborted", @"Parse error")

#define ATTR_NOT_FOUND_MSG \
  NSLocalizedString(@"Attribute not found", @"Parse error")

#define EXPECTED_UINT_VALUE_MSG \
  NSLocalizedString(@"Expected unsigned integer value", @"Parse error")
#define EXPECTED_INT_VALUE_MSG \
  NSLocalizedString(@"Expected integer value", @"Parse error")
#define EXPECTED_BOOL_VALUE_MSG \
  NSLocalizedString(@"Expected boolean value", @"Parse error")
#define EXPECTED_DATE_VALUE_MSG \
  NSLocalizedString(@"Expected date value", @"Parse error")
#define EXPECTED_TIME_VALUE_MSG \
  NSLocalizedString(@"Expected time value", @"Parse error")

#define UNRECOGNIZED_VALUE_MSG \
  NSLocalizedString(@"Unrecognized value", @"Parse error")


@interface TreeReader (PrivateMethods) 

@property (nonatomic, readonly, strong) NSXMLParser *parser;
@property (nonatomic, readonly, strong) TreeBalancer *treeBalancer;

@property (nonatomic, readonly, strong) FilterTestRepository *filterTestRepository;
@property (nonatomic, readonly, copy) NSMutableArray *mutableUnboundFilterTests;
@property (nonatomic, readonly, strong) NSMutableDictionary *timeCache;

- (void) setParseError:(NSError *)error;

- (void) processingFolder:(DirectoryItem *)dirItem;
- (void) processedFolder:(DirectoryItem *)dirItem;

@end


@interface ElementHandler : NSObject <NSXMLParserDelegate> {
  NSString  *elementName;
  TreeReader  *reader;

  id  callback;
  SEL  successSelector;
}

// Overrides super's designated initialiser.
- (instancetype) init NS_UNAVAILABLE;

- (instancetype) initWithElement:(NSString *)elementName
                          reader:(TreeReader *)reader
                        callback:(id) callback
                       onSuccess:(SEL)successSelector NS_DESIGNATED_INITIALIZER;


/* Generic callback method for when a child handler completes successfully. Subclasses should define
 * and use additional callback methods of their own for handling specific child elements and
 * subsequently call this method for the generic clean-up.
 *
 * Note: This method is used as the callback for "unrecognized" elements, so care should be taken
 * when overriding this method (there should be no need).
 */
- (void) handler:(ElementHandler *)handler
           finishedParsingElement:(id)result;

/* Callback methods when child handler failed. The error callback cannot be configured so this
 * method will be always called.
 */
- (void) handler:(ElementHandler *)handler
           failedParsingElement:(NSError *)parseError;


/* Called once to provide the handler with the attributes for the element.
 */
- (void) handleAttributes:(NSDictionary *)attribs;

/* Called when the start of a new child element is encountered.
 */
- (void) handleChildElement:(NSString *)elementName
                 attributes:(NSDictionary *)attribs;

/* Called when the end of the element represented by this handler is encountered.
 */
@property (nonatomic, readonly, strong) id objectForElement;

/* Should be called when the handler encounters an error (i.e. so it should not be called when the
 * parser has signalled an error). It will abort the parsing.
 */
- (void) handlerError:(NSString *)details;

/* Should be called when the handler encounters an error when parsing the attributes. It will
 * indirectly invoke -handleError:.
 */
- (void) handlerAttributeParseError:(NSException *)ex;


- (NSString *)getStringAttributeValue:(NSString *)name
                                 from:(NSDictionary *)attribs;
- (NSString *)getStringAttributeValue:(NSString *)name
                                 from:(NSDictionary *)attribs
                         defaultValue:(NSString *)defVal;

- (item_size_t) getItemSizeAttributeValue:(NSString *)name
                                   from:(NSDictionary *)attribs;
- (item_size_t) getItemSizeAttributeValue:(NSString *)name
                                   from:(NSDictionary *)attribs
                           defaultValue:(item_size_t) defVal;

- (NSDate *)getDateAttributeValue:(NSString *)name
                             from:(NSDictionary *)attribs;
- (NSDate *)getDateAttributeValue:(NSString *)name
                             from:(NSDictionary *)attribs
                     defaultValue:(NSDate *)defVal;

- (int) getIntegerAttributeValue:(NSString *)name
                            from:(NSDictionary *)attribs;
- (int) getIntegerAttributeValue:(NSString *)name
                            from:(NSDictionary *)attribs
                    defaultValue:(int)defVal;

- (BOOL) getBooleanAttributeValue:(NSString *)name
                             from:(NSDictionary *)attribs;
- (BOOL) getBooleanAttributeValue:(NSString *)name
                             from:(NSDictionary *)attribs
                     defaultValue:(BOOL)defVal;

- (CFAbsoluteTime) getTimeAttributeValue:(NSString *)name
                                    from:(NSDictionary *)attribs;
- (CFAbsoluteTime) getTimeAttributeValue:(NSString *)name
                                    from:(NSDictionary *)attribs
                            defaultValue:(CFAbsoluteTime) defVal;

@end // @interface ElementHandler


@interface ElementHandler (PrivateMethods) 

- (item_size_t) parseItemSizeAttribute:(NSString *)name value:(NSString *)value;
- (NSDate *) parseDateAttribute:(NSString *)name value:(NSString *)value;
- (int) parseIntegerAttribute:(NSString *)name value:(NSString *)value;
- (BOOL) parseBooleanAttribute:(NSString *)name value:(NSString *)value;
- (CFAbsoluteTime) parseTimeAttribute:(NSString *)name value:(NSString *)value;

@end // @interface ElementHandler (PrivateMethods) 


@interface ScanDumpElementHandler : ElementHandler {
  AnnotatedTreeContext  *annotatedTree;
}

- (void) handler:(ElementHandler *)handler
           finishedParsingScanInfoElement:(AnnotatedTreeContext *)tree;

@end // @interface ScanDumpElementHandler


@interface ScanInfoElementHandler : ElementHandler {
  NSString  *comments;
  TreeContext  *tree;
}

- (void) handler:(ElementHandler *)handler
           finishedParsingCommentsElement:(NSString *)comments;
- (void) handler:(ElementHandler *)handler
           finishedParsingFilterSetElement:(FilterSet *)filterSet;
- (void) handler:(ElementHandler *)handler
           finishedParsingFolderElement:(DirectoryItem *)dirItem;

@end // @interface ScanInfoElementHandler


@interface ScanCommentsElementHandler : ElementHandler {
  NSMutableString  *comments;
}
 
@end // @interface ScanCommentsElementHandler


@interface FilterSetElementHandler : ElementHandler {
  NSMutableArray  *namedFilters;
  BOOL  packagesAsFiles;
}

- (void) handler: (ElementHandler *)handler 
           finishedParsingFilterElement: (NamedFilter *) filter;
 
@end // @interface FilterSetElementHandler


@interface FilterElementHandler : ElementHandler {
  NSMutableArray  *filterTests;
  NSString  *name;
}

- (void) handler:(ElementHandler *)handler
           finishedParsingFilterTestElement:(FilterTestRef *)filterTest;

@end // @interface FilterElementHandler


@interface FilterTestElementHandler : ElementHandler {
  FilterTestRef  *filterTest;
}

@end // @interface FilterTestElementHandler


@interface FolderElementHandler : ElementHandler {
  DirectoryItem  *parentItem;
  DirectoryItem  *dirItem;
  NSMutableArray  *files;
  NSMutableArray  *dirs;
}

- (instancetype) initWithElement:(NSString *)elementName
                          reader:(TreeReader *)reader
                        callback:(id)callback
                       onSuccess:(SEL)successSelector
                          parent:(DirectoryItem *)parent NS_DESIGNATED_INITIALIZER;

- (void) handler:(ElementHandler *)handler
           finishedParsingFolderElement:(DirectoryItem *) dirItem;
- (void) handler:(ElementHandler *)handler
           finishedParsingFileElement:(PlainFileItem *) fileItem;

// Returns an allocated but uninitialised directory item. This extension method is provided so that
// ScanTreeRootElementHandler can override it.
- (DirectoryItem *)allocDirectoryItem;

@end // @interface FolderElementHandler


@interface ScanTreeRootElementHandler : FolderElementHandler {
}
@end // @interface ScanTreeRootElementHandler


@interface FileElementHandler : ElementHandler {
  DirectoryItem  *parentItem;
  PlainFileItem  *fileItem;
}

- (instancetype) initWithElement:(NSString *)elementName
                          reader:(TreeReader *)reader
                        callback:(id)callback
                       onSuccess:(SEL)successSelector
                          parent:(DirectoryItem *)parent NS_DESIGNATED_INITIALIZER;

@end // @interface FileElementHandler


@interface AttributeParseException : NSException {
}

// Overrides designated initialiser.
- (instancetype) initWithName:(NSString *)name
                       reason:(NSString *)reason
                     userInfo:(NSDictionary *)userInfo NS_UNAVAILABLE;

- (instancetype) initWithAttributeName:(NSString *)attribName
                                reason:(NSString *)reason NS_DESIGNATED_INITIALIZER;
         
+ (instancetype) exceptionWithAttributeName:(NSString *)attribName
                                     reason:(NSString *)reason;

@end // @interface AttributeParseException


@implementation TreeReader

- (instancetype) init {
  return [self initWithFilterTestRepository: FilterTestRepository.defaultFilterTestRepository];
}

- (instancetype) initWithFilterTestRepository:(FilterTestRepository *)repository {
  if (self = [super init]) {
    testRepository = [repository retain];
  
    parser = nil;
    tree = nil;
    autoreleasePool = nil;
    error = nil;
    abort = NO;
    decompressor = nil;
    unboundTests = nil;

    treeBalancer = [[TreeBalancer alloc] init];
    timeCache = [[NSMutableDictionary alloc] init];

    progressTracker = nil;
  }
  
  return self;
}

- (void) dealloc {
  NSAssert(parser == nil, @"parser should be nil.");
  NSAssert(autoreleasePool == nil, @"autoreleasePool should be nil");
  
  [testRepository release];

  [tree release]; 
  [error release];
  [unboundTests release];
  
  [progressTracker release];
  [treeBalancer release];

  [timeCache release];

  [super dealloc];
}

- (AnnotatedTreeContext *)readTreeFromFile:(NSURL *)url {
  NSAssert(parser == nil && tree == nil, @"Invalid state. Already reading?");

  NSOutputStream  *output;
  NSInputStream  *decompressedOutput;

  [NSStream getBoundStreamsWithBufferSize: DECOMPRESSED_BUFFER_SIZE
                              inputStream: &decompressedOutput
                             outputStream: &output];

  decompressor = [[CompressedInput alloc] initWithSourceUrl: url outputStream: output];
  [decompressor open];

  NSInputStream  *parserInput = [[[InputStreamAdapter alloc]
                                  initWithInputStream: decompressedOutput] autorelease];
  [parserInput open];

  parser = [[NSXMLParser alloc] initWithStream: parserInput];
  parser.delegate = self;

  progressTracker = [[ReadProgressTracker alloc] initWithInputFile: url];
  unboundTests = [[NSMutableArray alloc] initWithCapacity: 8];
  abort = NO;
  error = nil;
  
  [unboundTests removeAllObjects];

  [parser parse];
  
  [progressTracker finishedTask];
  
  [parser release];
  parser = nil;

  [timeCache removeAllObjects];

  [autoreleasePool release];
  autoreleasePool = nil;

  [decompressor release];
  decompressor = nil;

  if (tree == nil && error == nil) {
    // Trigger error when an empty file was read (or a file without any XML elements).
    error = [[ApplicationError errorWithLocalizedDescription: NO_TREE_ERROR_MSG] retain];
  }

  return (error != nil || abort) ? nil : tree;
}


- (void) abort {
  // TODO: Find out if NSXMLParser's -abortParsing is threadsafe. 
  // 
  // In the meantime, aborting ongoing parsing in a more roundabout way that is guaranteed to be
  // threadsafe (it calls -abortParsing from the thread that also called -parse).
  
  abort = YES;
}

/* Returns YES iff the reading task was aborted externally (i.e. using -abort).
 */
- (BOOL) aborted {
  return abort;
}

- (AnnotatedTreeContext *)annotatedTreeContext {
  return tree;
}

- (NSError *)error {
  return error;
}

- (NSArray *)unboundFilterTests {
  // Return a copy
  return [NSArray arrayWithArray: unboundTests];
}

- (NSDictionary *)progressInfo {
  // Only return progress info while task has not been aborted. When task is aborted, handlers are
  // released, as are the objects they were constructing. This can trigger a memory access violation
  // when trying to construct the path for the current folder being scanned.
  return abort ? nil : progressTracker.progressInfo;
}

- (void) setFormatVersion:(int)version {
  formatVersion = version;
}

- (int) formatVersion {
  return formatVersion;
}


//----------------------------------------------------------------------------
// NSXMLParser delegate methods

- (void) parser:(NSXMLParser *)parserVal 
didStartElement:(NSString *)elementName
   namespaceURI:(NSString *)namespaceURI
  qualifiedName:(NSString *)qName
     attributes:(NSDictionary *)attribs {
  NSError  *parseError = nil;
  if (tree != nil) {
    parseError = [ApplicationError errorWithLocalizedDescription: MULTIPLE_ROOT_ELEM_MSG];
  }
  else if (! [elementName isEqualToString: ScanDumpElem]) {
    parseError = [ApplicationError errorWithLocalizedDescription:
                  [NSString stringWithFormat: EXPECTED_ELEM_MSG, ScanDumpElem]];
  }
  
  if (parseError != nil) {
    [self setParseError: parseError];
    [parser abortParsing];
  }
  else {
    ScanDumpElementHandler  *handler = [ScanDumpElementHandler alloc];
    [[handler initWithElement: elementName
                       reader: self
                     callback: self
                    onSuccess: @selector(handler:finishedParsingScanDumpElement:)
      ] handleAttributes: attribs];
  }
}

- (void) parser:(NSXMLParser *)parser 
           parseErrorOccurred:(NSError *)parseError {
  [self setParseError: parseError];
}


//----------------------------------------------------------------------------
// Handler callback methods

- (void) handler:(ElementHandler *)handler failedParsingElement:(NSError *)parseError {
  parser.delegate = self;
  
  [self setParseError: parseError];
  
  [handler release];
  
  [parser abortParsing];
}

- (void) handler:(ElementHandler *)handler
           finishedParsingScanDumpElement:(AnnotatedTreeContext *)treeVal {
  parser.delegate = self;
  
  tree = [treeVal retain];
    
  [handler release];
}

@end // @implementation TreeReader


@implementation TreeReader (PrivateMethods) 

- (NSXMLParser *)parser {
  return parser;
}

- (TreeBalancer *)treeBalancer {
  return treeBalancer;
}

- (FilterTestRepository *)filterTestRepository {
  return testRepository;
}

- (NSMutableArray *)mutableUnboundFilterTests {
  return unboundTests;
}

- (NSMutableDictionary *)timeCache {
  return timeCache;
}


- (void) setParseError:(NSError *)parseError {
  if (
    error == nil // There is no error yet
    && !abort    // ... and parsing has not been aborted (this also
                 // triggers an error, which should be ignored).
  ) {
    error = 
      [[ApplicationError alloc] initWithLocalizedDescription:
          [NSString stringWithFormat: PARSE_ERROR_MSG,
                      (int)parser.lineNumber,
                      parseError.localizedDescription]];
  }
}


- (void) processingFolder:(DirectoryItem *)dirItem {
  unsigned long long bytesRead = decompressor != nil ? decompressor.totalBytesRead : 0;
  [progressTracker processingFolder: dirItem bytesRead: bytesRead];
}

- (void) processedFolder:(DirectoryItem *)dirItem {
  [progressTracker processedFolder: dirItem];
  if ([progressTracker numFoldersProcessed] % AUTORELEASE_PERIOD == 0) {
    // Drain auto-release pool to prevent high memory usage while reading is in progress. The
    // temporary objects created while reading the tree can be three times larger in size than the
    // footprint of the actual tree in memory.
    [autoreleasePool release];
    autoreleasePool = [[NSAutoreleasePool alloc] init];
  }
}

@end // @implementation  TreeReader (PrivateMethods)


@implementation ElementHandler

- (instancetype) initWithElement:(NSString *)elementNameVal
                          reader:(TreeReader *)readerVal
                        callback:(id)callbackVal
                       onSuccess:(SEL)successSelectorVal {
  if (self = [super init]) {
    elementName = [elementNameVal retain];
    
    // Not retaining these, as these are not "owned"
    reader = readerVal;
    callback = callbackVal;

    successSelector = successSelectorVal;
    
    reader.parser.delegate = self;
  }
  
  return self;
}

- (void) dealloc {
  [elementName release];

  [super dealloc];
}


//----------------------------------------------------------------------------
// NSXMLParser delegate methods (there should be no need to override these)

- (void) parser:(NSXMLParser *)parser
didStartElement:(NSString *)childElement
   namespaceURI:(NSString *)namespaceURI
  qualifiedName:(NSString *)qName
     attributes:(NSDictionary *)attribs {
  if (reader.aborted) {
    // Although the TreeReader actually ignores it, given that the error callback is used, for
    // consistency provide a properly initialised error object.
    NSError  *error = [ApplicationError errorWithLocalizedDescription: PARSING_ABORTED_MSG];
    [callback handler: self failedParsingElement: error];
  }
  else {
    [self handleChildElement: childElement attributes: attribs];
  }
}

- (void) parser:(NSXMLParser *)parser
  didEndElement:(NSString *)elementNameVal
   namespaceURI:(NSString *)namespaceURI
  qualifiedName:(NSString *)qName {
  NSAssert([elementNameVal isEqualToString: elementName], @"Unexpected end of element");

  [callback performSelector: successSelector
                 withObject: self
                 withObject: [self objectForElement]];
}

- (void) parser:(NSXMLParser *)parser parseErrorOccurred:(NSError *)parseError {
  [callback handler: self failedParsingElement: parseError];
}


//----------------------------------------------------------------------------
// Handler callback methods

- (void) handler:(ElementHandler *)handler failedParsingElement:(NSError *)parseError {
  reader.parser.delegate = self;
  
  [callback handler: self failedParsingElement: parseError];

  [handler release];
}

- (void) handler:(ElementHandler *)handler finishedParsingElement:(id)result {
  reader.parser.delegate = self;

  [handler release];
}


//----------------------------------------------------------------------------

/* Does nothing. To be overridden.
 */
- (void) handleAttributes:(NSDictionary *)attribs {
  // void
}

/* Called when the start of a new child element is encountered.
 *
 * Handles element by ignoring it. Override it to handle "known" elements, and let this
 * implementation handle all unrecognized ones.
 */
- (void) handleChildElement:(NSString *)childElement attributes:(NSDictionary *)attribs {
  [[[ElementHandler alloc] initWithElement: childElement
                                    reader: reader
                                  callback: self
                                 onSuccess: @selector(handler:finishedParsingElement:)]
   handleAttributes: attribs];
}

/* Called when the end of the element represented by this handler is 
 * encountered.
 *
 * Returns nil. Override it to return an object that represents the element.
 */
- (id) objectForElement {
  return nil;
}

- (void) handlerError:(NSString *)details {
  NSError  *error = [ApplicationError errorWithLocalizedDescription: details];
  [callback handler: self failedParsingElement: error];
}

- (void) handlerAttributeParseError:(NSException *)ex {
  NSString  *details = [NSString stringWithFormat: ATTR_PARSE_ERROR_MSG,
                        ex.userInfo[AttributeNameKey], ex.reason];

  [self handlerError: details];
}


//----------------------------------------------------------------------------
// Attribute parsing helper methods

- (NSString *)getStringAttributeValue:(NSString *)name from:(NSDictionary *)attribs {
  NSString  *value = attribs[name];

  if (value != nil) {
    return value;
  } 

  @throw [AttributeParseException exceptionWithAttributeName: name
                                                      reason: ATTR_NOT_FOUND_MSG];
}

- (NSString *)getStringAttributeValue:(NSString *)name
                                 from:(NSDictionary *)attribs
                         defaultValue:(NSString *)defVal {
  NSString  *value = attribs[name];

  return (value != nil) ? value : defVal;
}


- (item_size_t) getItemSizeAttributeValue:(NSString *)name
                                   from:(NSDictionary *)attribs {
  return [self parseItemSizeAttribute: name
                                value: [self getStringAttributeValue: name from: attribs]];
}

- (item_size_t) getItemSizeAttributeValue:(NSString *)name
                                   from:(NSDictionary *)attribs
                           defaultValue:(item_size_t) defVal {
  NSString  *stringValue = attribs[name];

  return (stringValue != nil) ? [self parseItemSizeAttribute: name value: stringValue] : defVal;
}


- (NSDate *)getDateAttributeValue:(NSString *)name from:(NSDictionary *)attribs {
  return [self parseDateAttribute: name
                            value: [self getStringAttributeValue: name from: attribs]];
}

- (NSDate *)getDateAttributeValue:(NSString *)name
                             from:(NSDictionary *)attribs
                     defaultValue:(NSDate *)defVal {
  NSString  *stringValue = attribs[name];

  return (stringValue != nil) ? [self parseDateAttribute: name value: stringValue] : defVal;
}


- (int) getIntegerAttributeValue:(NSString *)name from:(NSDictionary *)attribs {
  return [self parseIntegerAttribute: name
                               value: [self getStringAttributeValue: name from: attribs]];
}

- (int) getIntegerAttributeValue:(NSString *)name
                            from:(NSDictionary *)attribs
                    defaultValue:(int)defVal {
  NSString  *stringValue = attribs[name];

  return (stringValue != nil) ? [self parseIntegerAttribute: name value: stringValue] : defVal;
}

- (BOOL) getBooleanAttributeValue:(NSString *)name from:(NSDictionary *)attribs {
  return [self parseBooleanAttribute: name 
                               value: [self getStringAttributeValue: name from: attribs]];
}

- (BOOL) getBooleanAttributeValue:(NSString *)name
                             from:(NSDictionary *)attribs
                     defaultValue:(BOOL)defVal {
  NSString  *stringValue = attribs[name];
  
  return (stringValue != nil) ? [self parseBooleanAttribute: name value: stringValue] : defVal;
}

- (CFAbsoluteTime) getTimeAttributeValue:(NSString *)name
                                    from:(NSDictionary *)attribs {
  return [self getTimeAttributeValue: name 
                                from: attribs 
                        defaultValue: 0];
}

- (CFAbsoluteTime) getTimeAttributeValue:(NSString *)name
                                    from:(NSDictionary *)attribs
                            defaultValue:(CFAbsoluteTime)defVal {
  NSString  *stringValue = attribs[name];
  
  return (stringValue != nil) ? [self parseTimeAttribute: name value: stringValue] : defVal;
}

@end // @implementation ElementHandler


@implementation ElementHandler (PrivateMethods) 

- (item_size_t) parseItemSizeAttribute: (NSString *)name 
                               value: (NSString *)stringValue {
  // Using own parsing code instead of NSScanner's scanLongLong for two reasons:
  // 1) NSScanner cannot handle unsigned long long values
  // 2) This is faster (partly because there's no need to allocate and release memory).

  item_size_t  size = 0;
  NSUInteger  i = 0;
  NSUInteger  len = stringValue.length;
  while (i < len) {
    unichar  ch = [stringValue characterAtIndex: i++];
    
    if (ch < '0' || ch > '9') {
      @throw [AttributeParseException exceptionWithAttributeName: name
                                                          reason: EXPECTED_UINT_VALUE_MSG];
    }
    
    size = size * 10 + (ch - '0');
  }
  
  return size;
}

- (NSDate *)parseDateAttribute:(NSString *)name value:(NSString *)stringValue {
  // Try to parse format used by writer
  NSDate  *dateValue = [TreeWriter.nsTimeFormatter dateFromString: stringValue];
  if (dateValue != nil) {
    return dateValue;
  }

  // Try to parse format formerly used for <ScanInfo>: -(NSString*)description
  static NSDateFormatter *descriptionFormat = nil;
  if (descriptionFormat == nil) {
      descriptionFormat = [[NSDateFormatter alloc] init];
      descriptionFormat.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
      descriptionFormat.dateFormat = @"yyyy-MM-dd HH:mm:ss X";
  }
  dateValue = [descriptionFormat dateFromString: stringValue];
  if (dateValue != nil) {
    return dateValue;
  }

  @throw [AttributeParseException exceptionWithAttributeName: name
                                                      reason: EXPECTED_DATE_VALUE_MSG];
}

- (int) parseIntegerAttribute:(NSString *)name value:(NSString *)stringValue {
  // Note: Explicitly releasing scanner to minimise use of autorelease pool.
  NSScanner  *scanner = [[NSScanner alloc] initWithString: stringValue];
  int  intValue;
  BOOL  ok  = ( [scanner scanInt: &intValue] && scanner.atEnd );
  [scanner release];
     
  if (! ok) {
    @throw [AttributeParseException exceptionWithAttributeName: name
                                                        reason: EXPECTED_INT_VALUE_MSG];
  }
  
  return intValue;
}

- (BOOL) parseBooleanAttribute:(NSString *)name value:(NSString *)value {
  NSString  *lcValue = value.lowercaseString;
  
  if ([lcValue isEqualToString: @"true"] ||
      [lcValue isEqualToString: @"1"]) {
    return YES;
  }
  else if ([lcValue isEqualToString: @"false"] ||
           [lcValue isEqualToString: @"0"]) {
    return NO;
  }
  
  @throw [AttributeParseException exceptionWithAttributeName: name
                                                      reason: EXPECTED_BOOL_VALUE_MSG];
}
          
- (CFAbsoluteTime) parseTimeAttribute:(NSString *)name value:(NSString *)stringValue {
  NSNumber  *timeValue = [reader.timeCache objectForKey: stringValue];
  if (timeValue != nil) {
    return timeValue.doubleValue;
  }

  // Try to parse format used by writer
  NSDate  *dateValue = [TreeWriter.nsTimeFormatter dateFromString: stringValue];
  if (dateValue != nil) goto DONE;

  // Try to parse format formerly used for <File>s and <Folder>s: en_GB
  static NSDateFormatter *enGBFormat = nil;
  if (enGBFormat == nil) {
    enGBFormat = [[NSDateFormatter alloc] init];
    enGBFormat.locale = [NSLocale localeWithLocaleIdentifier: @"en_US_POSIX"];
    enGBFormat.dateFormat = @"dd/MM/yyyy HH:mm";
  }
  dateValue = [enGBFormat dateFromString: stringValue];
  if (dateValue != nil) goto DONE;

  // en_GB format changed in OS X 10.11 to add a comma for some reason
  static NSDateFormatter *enGBCommaFormat = nil;
  if (enGBCommaFormat == nil) {
    enGBCommaFormat = [[NSDateFormatter alloc] init];
    enGBCommaFormat.locale = [NSLocale localeWithLocaleIdentifier: @"en_US_POSIX"];
    enGBCommaFormat.dateFormat = @"dd/MM/yyyy, HH:mm";
  }
  if (dateValue != nil) goto DONE;

  @throw [AttributeParseException exceptionWithAttributeName: name
                                                      reason: EXPECTED_TIME_VALUE_MSG];

  DONE:
  timeValue = @(CFDateGetAbsoluteTime((CFDateRef)dateValue));
  [reader.timeCache setValue: timeValue forKey: stringValue];
  return timeValue.doubleValue;
}

@end // @implementation ElementHandler (PrivateMethods) 


@implementation ScanDumpElementHandler 

- (instancetype) initWithElement:(NSString *)elementNameVal
                          reader:(TreeReader *)readerVal
                        callback:(id)callbackVal
                       onSuccess:(SEL)successSelectorVal {
  if (self = [super initWithElement: elementNameVal
                             reader: readerVal
                           callback: callbackVal
                          onSuccess: successSelectorVal]) {
    annotatedTree = nil;
  }
  
  return self;
}

- (void) dealloc {
  [annotatedTree release];
  
  [super dealloc];
}


- (void) handleAttributes:(NSDictionary *)attribs {
  int  formatVersion = [self getIntegerAttributeValue: FormatVersionAttr
                                                 from: attribs
                                         defaultValue: 0];
  [reader setFormatVersion: formatVersion];

  [super handleAttributes: attribs];
}

- (void) handleChildElement:(NSString *)childElement attributes:(NSDictionary *)attribs {
  if ([childElement isEqualToString: ScanInfoElem]) {
    if (annotatedTree != nil) {
      [self handlerError: [NSString stringWithFormat: MULTIPLE_ELEM_MSG, ScanInfoElem]];
    }
    else {
      ScanInfoElementHandler  *handler = [ScanInfoElementHandler alloc];
      [[handler initWithElement: childElement
                         reader: reader
                       callback: self
                      onSuccess: @selector(handler:finishedParsingScanInfoElement:)]
       handleAttributes: attribs];
    }
  }
  else {
    [super handleChildElement: childElement attributes: attribs];
  }
}

- (id) objectForElement {
  return annotatedTree;
}

- (void) handler:(ElementHandler *)handler
           finishedParsingScanInfoElement:(AnnotatedTreeContext *)treeVal {
  NSAssert(annotatedTree == nil, @"Tree not nil.");
  
  annotatedTree = [treeVal retain];
  
  [self handler: handler finishedParsingElement: treeVal];
}
  
@end // @implementation ScanDumpElementHandler


@implementation ScanInfoElementHandler 

- (instancetype) initWithElement:(NSString *)elementNameVal
                          reader:(TreeReader *)readerVal
                        callback:(id)callbackVal
                       onSuccess:(SEL)successSelectorVal {
  if (self = [super initWithElement: elementNameVal
                             reader: readerVal
                           callback: callbackVal
                          onSuccess: successSelectorVal]) {
    comments = nil;
    tree = nil;
  }
  
  return self;
}

- (void) dealloc {
  [comments release];
  [tree release];
  
  [super dealloc];
}


- (void) handleAttributes:(NSDictionary *)attribs {
  NSAssert(tree == nil, @"tree not nil.");
  
  @try {
    NSString  *volumePath = [self getStringAttributeValue: VolumePathAttr from: attribs];
    item_size_t  volumeSize = [self getItemSizeAttributeValue: VolumeSizeAttr from: attribs];
    item_size_t  freeSpace = [self getItemSizeAttributeValue: FreeSpaceAttr from: attribs];
    NSDate  *scanTime = [self getDateAttributeValue: ScanTimeAttr from: attribs];
    NSString  *sizeMeasure = [self getStringAttributeValue: FileSizeMeasureAttr from: attribs];

    if (! ([sizeMeasure isEqualToString: LogicalFileSizeName] ||
           [sizeMeasure isEqualToString: PhysicalFileSizeName] ||
           [sizeMeasure isEqualToString: TallyFileSizeName]) ) {
      @throw [AttributeParseException exceptionWithAttributeName: FileSizeMeasureAttr
                                                          reason: UNRECOGNIZED_VALUE_MSG];
    }
  
    tree = [[TreeContext alloc] initWithVolumePath: volumePath
                                   fileSizeMeasure: sizeMeasure
                                        volumeSize: volumeSize
                                         freeSpace: freeSpace
                                         filterSet: nil
                                          scanTime: scanTime];
  }
  @catch (AttributeParseException *ex) {
    [self handlerAttributeParseError: ex];
  }
}
  
- (void) handleChildElement:(NSString *)childElement attributes:(NSDictionary *)attribs {
  if ([childElement isEqualToString: ScanCommentsElem]) {
    if (comments != nil) {
      [self handlerError: [NSString stringWithFormat: MULTIPLE_ELEM_MSG, ScanCommentsElem]];
    }
    else {
      ScanCommentsElementHandler  *handler = [ScanCommentsElementHandler alloc];
      [[handler initWithElement: childElement
                         reader: reader
                       callback: self
                      onSuccess: @selector(handler:finishedParsingCommentsElement:)]
       handleAttributes: attribs];
    }
  }
  else if ([childElement isEqualToString: FilterSetElem]) {
    if (tree.scanTree != nil) {
      [self handlerError: FILTER_AFTER_FOLDER_MSG];
    }
    else if (tree.filterSet.numFilters > 0) {
      [self handlerError: [NSString stringWithFormat: MULTIPLE_ELEM_MSG, FilterSetElem]];
    }
    else {
      FilterSetElementHandler  *handler = [FilterSetElementHandler alloc];
      [[handler initWithElement: childElement
                         reader: reader
                       callback: self
                      onSuccess: @selector(handler:finishedParsingFilterSetElement:)]
       handleAttributes: attribs];
    }
  }
  else if ([childElement isEqualToString: FolderElem]) {
    if (tree.scanTree.fileItems != nil || tree.scanTree.directoryItems != nil) {
      [self handlerError: MULTIPLE_ROOT_FOLDER_MSG];
    }
    else {
      ScanTreeRootElementHandler  *handler = [ScanTreeRootElementHandler alloc];
      [[handler initWithElement: childElement
                         reader: reader
                       callback: self
                      onSuccess: @selector(handler:finishedParsingFolderElement:)
                         parent: tree.scanTreeParent]
       handleAttributes: attribs];
    }
  }
  else {
    [super handleChildElement: childElement attributes: attribs];
  }
}

- (id) objectForElement {
  return [AnnotatedTreeContext annotatedTreeContext: tree comments: comments];
}


- (void) handler:(ElementHandler *)handler
           finishedParsingCommentsElement:(NSString *)commentsVal {
  comments = [commentsVal retain];
  
  [self handler: handler finishedParsingElement: comments];
}

- (void) handler:(ElementHandler *)handler finishedParsingFilterSetElement:(FilterSet *)filterSet {
  TreeContext  *oldTree = tree;

  // Replace tree by new one that also contains the given filter set. 
  tree = [[TreeContext alloc] initWithVolumePath: oldTree.volumeTree.systemPathComponent
                                 fileSizeMeasure: oldTree.fileSizeMeasure
                                      volumeSize: oldTree.volumeSize
                                       freeSpace: oldTree.freeSpace
                                       filterSet: filterSet
                                        scanTime: oldTree.scanTime];

  [oldTree release];

  [self handler: handler finishedParsingElement: filterSet];
}

- (void) handler:(ElementHandler *)handler finishedParsingFolderElement:(DirectoryItem *) dirItem {
  [tree setScanTree: dirItem];
  
  [self handler: handler finishedParsingElement: dirItem];
}
  
@end // @implementation ScanInfoElementHandler 


@implementation ScanCommentsElementHandler 

- (instancetype) initWithElement:(NSString *)elementNameVal
                          reader:(TreeReader *)readerVal
                        callback:(id)callbackVal
                       onSuccess:(SEL)successSelectorVal {
  if (self = [super initWithElement: elementNameVal
                             reader: readerVal
                           callback: callbackVal
                          onSuccess: successSelectorVal]) {
    comments = [[NSMutableString alloc] initWithCapacity: 256];
  }
  
  return self;
}

- (void) dealloc {
  [comments release];
  
  [super dealloc];
}


- (id) objectForElement {
  return comments;
}

- (void)parser:(NSXMLParser *)parser foundCharacters:(NSString *)string {
  [comments appendString: string];
}

@end // @implementation ScanCommentsElementHandler


@implementation FilterSetElementHandler 

- (instancetype) initWithElement:(NSString *)elementNameVal
                          reader:(TreeReader *)readerVal
                        callback:(id)callbackVal
                       onSuccess:(SEL)successSelectorVal {
  if (self = [super initWithElement: elementNameVal
                             reader: readerVal
                           callback: callbackVal
                          onSuccess: successSelectorVal]) {
    namedFilters = [[NSMutableArray alloc] initWithCapacity: 8];
    packagesAsFiles = YES;
  }
  
  return self;
}

- (void) dealloc {
  [namedFilters release];
  
  [super dealloc];
}

- (void) handleAttributes:(NSDictionary *)attribs {
  @try {
    packagesAsFiles = [self getBooleanAttributeValue: PackagesAsFilesAttr
                                                from: attribs
                                        defaultValue: YES];
  }
  @catch (AttributeParseException *ex) {
    [self handlerAttributeParseError: ex];
  }
}

- (void) handleChildElement:(NSString *)childElement attributes:(NSDictionary *)attribs {
 if ([childElement isEqualToString: FilterElem]) {
   FilterElementHandler  *handler = [FilterElementHandler alloc];
    [[handler initWithElement: childElement
                       reader: reader
                     callback: self
                    onSuccess: @selector(handler:finishedParsingFilterElement:)]
     handleAttributes: attribs];
  }
  else {
    [super handleChildElement: childElement attributes: attribs];
  }
}

- (id) objectForElement {
  NSMutableArray  *unboundTests = reader.mutableUnboundFilterTests;

  // Note: Setting "nil" filterRepository to ensure that filter definition as read is retained.
  return [FilterSet filterSetWithNamedFilters: namedFilters
                              packagesAsFiles: packagesAsFiles
                             filterRepository: nil
                               testRepository: reader.filterTestRepository
                               unboundFilters: nil
                                 unboundTests: unboundTests];
}

- (void) handler:(ElementHandler *)handler finishedParsingFilterElement:(NamedFilter *)namedFilter {
  [namedFilters addObject: namedFilter];

  [self handler: handler finishedParsingElement: namedFilter];
}

@end // @implementation FilterSetElementHandler


@implementation FilterElementHandler 

- (instancetype) initWithElement:(NSString *)elementNameVal
                          reader:(TreeReader *)readerVal
                        callback:(id)callbackVal
                       onSuccess:(SEL)successSelectorVal {
  if (self = [super initWithElement: elementNameVal
                             reader: readerVal
                           callback: callbackVal
                          onSuccess: successSelectorVal]) {
    filterTests = [[NSMutableArray alloc] initWithCapacity: 8];
    name = nil;
  }
  
  return self;
}

- (void) dealloc {
  [name release];
  [filterTests release];
  
  [super dealloc];
}


- (void) handleAttributes:(NSDictionary *)attribs {
  @try {
    name = [[self getStringAttributeValue: NameAttr from: attribs defaultValue: nil] retain];
  }
  @catch (AttributeParseException *ex) {
    [self handlerAttributeParseError: ex];
  }
}

- (void) handleChildElement:(NSString *)childElement attributes:(NSDictionary *)attribs {
  if ([childElement isEqualToString: FilterTestElem]) {
    FilterTestElementHandler  *handler = [FilterTestElementHandler alloc];
    [[handler initWithElement: childElement
                       reader: reader
                     callback: self
                    onSuccess: @selector(handler:finishedParsingFilterTestElement:)]
     handleAttributes: attribs];
  }
  else {
    [super handleChildElement: childElement attributes: attribs];
  }
}

- (id) objectForElement {
  Filter  *filter = [Filter filterWithFilterTests: filterTests];
  return [NamedFilter namedFilter: filter name: name];
}

- (void) handler:(ElementHandler *)handler
           finishedParsingFilterTestElement:(FilterTestRef *)filterTest {
  [filterTests addObject: filterTest];
  
  [self handler: handler finishedParsingElement: filterTest];
}

@end // @implementation FilterElementHandler


@implementation FilterTestElementHandler 

- (instancetype) initWithElement:(NSString *)elementNameVal
                          reader:(TreeReader *)readerVal
                        callback:(id)callbackVal
                       onSuccess:(SEL)successSelectorVal {
  if (self = [super initWithElement: elementNameVal
                             reader: readerVal
                           callback: callbackVal
                          onSuccess: successSelectorVal]) {
    filterTest = nil;
  }
  
  return self;
}

- (void) dealloc {
  [filterTest release];
  
  [super dealloc];
}


- (void) handleAttributes:(NSDictionary *)attribs {
  @try {
    NSString  *name = [self getStringAttributeValue: NameAttr from: attribs];
    
    BOOL  inv = [self getBooleanAttributeValue: InvertedAttr from: attribs defaultValue: NO];

    filterTest = [[FilterTestRef alloc] initWithName: name inverted: inv];
  }
  @catch (AttributeParseException *ex) {
    [self handlerAttributeParseError: ex];
  }
}

- (id) objectForElement {
  return filterTest;
}

@end // @implementation FilterTestElementHandler


@implementation FolderElementHandler 

// Overrides designated initialiser.
- (instancetype) initWithElement:(NSString *)elementNameVal
                          reader:(TreeReader *)readerVal
                        callback:(id)callbackVal
                       onSuccess:(SEL)successSelectorVal {
  NSAssert(NO, @"Invoke with parent argument.");
  return [self initWithElement: nil reader: nil callback: nil onSuccess: nil parent: nil];
}

- (instancetype) initWithElement:(NSString *)elementNameVal
                          reader:(TreeReader *)readerVal
                        callback:(id)callbackVal
                       onSuccess:(SEL)successSelectorVal
                          parent:(DirectoryItem *)parentVal {
  if (self = [super initWithElement: elementNameVal
                             reader: readerVal
                           callback: callbackVal
                          onSuccess: successSelectorVal]) {
    parentItem = [parentVal retain];
  }
  
  return self;
}

- (void) dealloc {
  [parentItem release];
  [dirItem release];
  
  [super dealloc];
}


- (void) handleAttributes:(NSDictionary *)attribs {
  @try {
    NSString  *name = [self getStringAttributeValue: NameAttr from: attribs];
    if ([reader formatVersion] < 6) {
      // Pre v6 names were stored using their friendly representation
      name = [FileItem systemPathComponentFor: name];
    }

    int  flags = [self getIntegerAttributeValue: FlagsAttr from: attribs defaultValue: 0];

    CFAbsoluteTime  creationTime = [self getTimeAttributeValue: CreatedAttr from: attribs];
    CFAbsoluteTime  modificationTime = [self getTimeAttributeValue: ModifiedAttr from: attribs];
    CFAbsoluteTime  accessTime = [self getTimeAttributeValue: AccessedAttr from: attribs];
    
    dirItem = [self allocDirectoryItem];
    [dirItem initWithLabel: name
                    parent: parentItem
                     flags: flags
              creationTime: creationTime
          modificationTime: modificationTime
                accessTime: accessTime];

    [reader processingFolder: dirItem];
  }
  @catch (AttributeParseException *ex) {
    [self handlerAttributeParseError: ex];
  }
}

- (void) handleChildElement:(NSString *)childElement attributes:(NSDictionary *)attribs {
 if ([childElement isEqualToString: FileElem]) {
   FileElementHandler  *handler = [FileElementHandler alloc];
    [[handler initWithElement: childElement
                       reader: reader
                     callback: self
                    onSuccess: @selector(handler:finishedParsingFileElement:)
                       parent: dirItem]
     handleAttributes: attribs];
  }
  else if ([childElement isEqualToString: FolderElem]) {
    FolderElementHandler  *handler = [FolderElementHandler alloc];
    [[handler initWithElement: childElement
                       reader: reader
                     callback: self
                    onSuccess: @selector(handler:finishedParsingFolderElement:)
                       parent: dirItem]
     handleAttributes: attribs];
  }
  else {
    [super handleChildElement: childElement attributes: attribs];
  }
}

- (id) objectForElement {
  [dirItem setSize];
  [dirItem balanceTree: reader.treeBalancer];

  [reader processedFolder: dirItem];
  
  return dirItem;
}


- (void) handler:(ElementHandler *)handler finishedParsingFolderElement:(DirectoryItem *)childItem {
  [dirItem addSubdir: childItem];
  
  [self handler: handler finishedParsingElement: childItem];
}

- (void) handler:(ElementHandler *)handler finishedParsingFileElement:(PlainFileItem *)childItem {
  [dirItem addFile: childItem];
  
  [self handler: handler finishedParsingElement: childItem];
}


- (DirectoryItem *)allocDirectoryItem {
  return [DirectoryItem alloc];
}

@end // @implementation FolderElementHandler 


@implementation ScanTreeRootElementHandler

- (DirectoryItem *)allocDirectoryItem {
  return [ScanTreeRoot alloc];
}

@end // @implementation ScanTreeRootElementHandler 

@implementation FileElementHandler 

// Overrides designated initialiser.
- (instancetype) initWithElement:(NSString *)elementNameVal
                          reader:(TreeReader *)readerVal
                        callback:(id)callbackVal
                       onSuccess:(SEL)successSelectorVal {
  NSAssert(NO, @"Invoke with parent argument.");
  return [self initWithElement: nil reader: nil callback: nil onSuccess: nil parent: nil];
}

- (instancetype) initWithElement:(NSString *)elementNameVal
                          reader:(TreeReader *)readerVal
                        callback:(id)callbackVal
                       onSuccess:(SEL)successSelectorVal
                          parent:(DirectoryItem *)parentVal {
  if (self = [super initWithElement: elementNameVal
                             reader: readerVal
                           callback: callbackVal
                          onSuccess: successSelectorVal]) {
    parentItem = [parentVal retain];
  }
  
  return self;
}

- (void) dealloc {
  [parentItem release];
  [fileItem release];
  
  [super dealloc];
}


- (void) handleAttributes:(NSDictionary *)attribs {
  @try {
    NSString  *name = [self getStringAttributeValue: NameAttr from: attribs];
    if ([reader formatVersion] < 6) {
      // Pre v6 names were stored using their friendly representation
      name = [FileItem systemPathComponentFor: name];
    }

    int  flags = [self getIntegerAttributeValue: FlagsAttr from: attribs defaultValue: 0];
    item_size_t  size = [self getItemSizeAttributeValue: SizeAttr from: attribs];
    
    UniformTypeInventory  *typeInventory = UniformTypeInventory.defaultUniformTypeInventory;
    UniformType  *fileType = [typeInventory uniformTypeForExtension: name.pathExtension];

    CFAbsoluteTime  creationTime = [self getTimeAttributeValue: CreatedAttr from: attribs];
    CFAbsoluteTime  modificationTime = [self getTimeAttributeValue: ModifiedAttr from: attribs];
    CFAbsoluteTime  accessTime = [self getTimeAttributeValue: AccessedAttr from: attribs];

    fileItem = [PlainFileItem alloc];
    [fileItem initWithLabel: name
                     parent: parentItem
                       size: size
                       type: fileType
                      flags: flags
               creationTime: creationTime
           modificationTime: modificationTime
                 accessTime: accessTime];
  }
  @catch (AttributeParseException *ex) {
    [self handlerAttributeParseError: ex];
  }
}

- (id) objectForElement {
  return fileItem;
}

@end // @implementation FileElementHandler


@implementation AttributeParseException 

- (instancetype) initWithAttributeName:(NSString *)attribName reason:(NSString *)reason {
  NSDictionary  *userInfo = @{AttributeNameKey: attribName};

  return [super initWithName: @"AttributeParseException"
                      reason: reason
                    userInfo: userInfo];
}

+ (instancetype) exceptionWithAttributeName:(NSString *)attribName reason:(NSString *)reason {
  return [[[AttributeParseException alloc] initWithAttributeName: attribName
                                                          reason: reason] autorelease];
}

@end // @implementation AttributeParseException
