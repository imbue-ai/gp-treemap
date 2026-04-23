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

#import "UniformTypeInventory.h"

#import "FileItem.h"
#import "UniformType.h"


NSString  *UniformTypeAddedEvent = @"uniformTypeAdded";

NSString  *UniformTypeKey = @"uniformType";

// The UTI that is used when the type is unknown (i.e. when there is no proper UTI associated with a
// given file or extension).
NSString  *UnknownTypeUTI = @"unknown";


@interface UniformTypeInventory (PrivateMethods) 

- (void) postNotification:(NSNotification *)notification;

- (UniformType *)createUniformTypeForIdentifier:(NSString *)uti;

@end


@implementation UniformTypeInventory

+ (UniformTypeInventory *)defaultUniformTypeInventory {
  static UniformTypeInventory  *defaultUniformTypeInventoryInstance = nil;
  static dispatch_once_t onceToken;

  dispatch_once(&onceToken, ^{
    defaultUniformTypeInventoryInstance = [[UniformTypeInventory alloc] init];
  });
  
  return defaultUniformTypeInventoryInstance;
}


// Overrides super's designated initialiser.
- (instancetype) init {
  if (self = [super init]) {
    typeForExtension = [[NSMutableDictionary alloc] initWithCapacity: 32];
    untypedExtensions = [[NSMutableSet alloc] initWithCapacity: 32];
    typeForUTI = [[NSMutableDictionary alloc] initWithCapacity: 32];
    childrenForUTI = [[NSMutableDictionary alloc] initWithCapacity: 32];
    parentlessTypes = [[NSMutableSet alloc] initWithCapacity: 8];
    
    // Create the UniformType object used when the type is unknown.
    NSString  *descr = NSLocalizedString(@"unknown file type",
                                         @"Description for 'unknown' UTI.");
    unknownType = [[UniformType alloc] initWithUniformTypeIdentifier: UnknownTypeUTI
                                                         description: descr
                                                             parents: @[]];
    typeForUTI[UnknownTypeUTI] = unknownType;
    [parentlessTypes addObject: unknownType];
  }
  
  return self;
}

- (void) dealloc {
  [unknownType release];
  
  [typeForExtension release];
  [untypedExtensions release];
  [typeForUTI release];
  [childrenForUTI release];
  [parentlessTypes release];
    
  [super dealloc];
}


- (NSUInteger) count {
  return typeForUTI.count;
}


- (UniformType *)unknownUniformType; {
  return unknownType;
}

- (NSEnumerator *)uniformTypeEnumerator {
  return [typeForUTI objectEnumerator];
}


- (UniformType *)uniformTypeForExtension:(NSString *)ext {
  UniformType  *type = typeForExtension[ext];
  if (type != nil) {
    // The extension was already encountered, and corresponds to a valid UTI.
    return type;
  }
  
  if ([untypedExtensions containsObject: ext]) {
    // The extension was already encountered, and has no proper UTI associated
    // with it.
    return unknownType;
  }

  NSString  *uti = (NSString *)UTTypeCreatePreferredIdentifierForTag
                                 (kUTTagClassFilenameExtension, (CFStringRef)ext, NULL);

  if (! [uti hasPrefix: @"dyn."]) {
    type = [self uniformTypeForIdentifier: uti];

    if (type != nil) {
      // Successfully obtained a UniformType for the UTI.
      //
      // Note: It is possible that a UTI has been registered for an extension without additional
      // information describing the type. In this case, no UniformType can be created, which is why
      // the check is needed.
      
      typeForExtension[ext] = type;
    }
  }

  CFRelease(uti);
  
  if (type != nil) {
    return type;
  }
  
  // No proper type could be constructed for the given UTI.
  [untypedExtensions addObject: ext];

  return unknownType;
}

- (UniformType *)uniformTypeForIdentifier:(NSString *)uti {
  id  typeOrSelf = typeForUTI[uti];

  if (typeOrSelf == self) {
    // Encountered cycle in the type conformance relationships. Breaking the loop to avoid infinite
    // recursion.

    return nil;
  }

  if (typeOrSelf != nil) {
    // It has already been registered
    return typeOrSelf;
  }

  // Temporarily associate "self" with the UTI to mark that the type is currently being created.
  // This is done to guard against infinite recursion should there be a cycle in the
  // type-conformance relationships.
  typeForUTI[uti] = self;
  UniformType  *type = [self createUniformTypeForIdentifier: uti];

  if (type == nil) {
    // No uniform type could be created for the UTI
    [typeForUTI removeObjectForKey: uti];

    return nil;
  }
  
  typeForUTI[uti] = type;
  childrenForUTI[uti] = @[];
  
  // Register it as a child for each parent
  for (UniformType *parentType in [type.parentTypes objectEnumerator]) {
    NSString  *parentUTI = [parentType uniformTypeIdentifier];
    NSArray  *children = childrenForUTI[parentUTI];
    
    childrenForUTI[parentUTI] = [children arrayByAddingObject: type];
  }
  
  // Notify interested observers
  NSNotification  *notification = 
    [NSNotification notificationWithName: UniformTypeAddedEvent 
                                  object: self
                                userInfo: @{UniformTypeKey: type}];
  [self performSelectorOnMainThread: @selector(postNotification:)
                         withObject: notification
                      waitUntilDone: NO];
  
  return type;
}


- (NSSet *)childrenOfUniformType:(UniformType *)type {
  return [NSSet setWithArray: childrenForUTI[[type uniformTypeIdentifier]]];
}


- (void) dumpTypesToLog {
  for (UniformType *type in [self uniformTypeEnumerator]) {
    NSLog(@"Type: %@", [type uniformTypeIdentifier]);
    NSLog(@"  Description: %@", [type description]);

    NSMutableString  *s = [NSMutableString stringWithCapacity: 64];
    for (UniformType *type2 in [type.parentTypes objectEnumerator]) {
      [s appendFormat: @" %@", [type2 uniformTypeIdentifier]];
    }
    NSLog(@"  Parents:%@", s);
    
    [s deleteCharactersInRange: NSMakeRange(0, s.length)];
    for (UniformType *type2 in [[self childrenOfUniformType: type] objectEnumerator]) {
      [s appendFormat: @" %@", [type2 uniformTypeIdentifier]];
    }
    NSLog(@"  Children:%@", s);
  }
}

@end // @implementation UniformTypeInventory


@implementation UniformTypeInventory (PrivateMethods)

- (void) postNotification:(NSNotification *)notification {
  [NSNotificationCenter.defaultCenter postNotification: notification];
}

- (UniformType *)createUniformTypeForIdentifier:(NSString *)uti {

  NSDictionary  *dict = (NSDictionary *)UTTypeCopyDeclaration( (CFStringRef)uti );
  [dict autorelease];
    
  if (dict == nil) {
    // The UTI is not recognized. 
    return nil;
  }

  NSString  *descr = dict[(NSString *)kUTTypeDescriptionKey];
    
  NSObject  *conforms = dict[(NSString *)kUTTypeConformsToKey];
  NSArray  *parents;
  if ([conforms isKindOfClass: [NSArray class]]) {
    NSArray  *utiArray = (NSArray *)conforms;

    // Create the corresponding array of type objects.
    NSMutableArray *temp = [NSMutableArray arrayWithCapacity: utiArray.count];

    for (NSString *parentUti in [utiArray objectEnumerator]) {
      UniformType  *parentType = [self uniformTypeForIdentifier: (NSString *)parentUti];
         
      if (parentType != nil) {
        [temp addObject: parentType];
      }
    }
    parents = temp;
  }
  else if ([conforms isKindOfClass: [NSString class]]) {
    UniformType  *parentType = [self uniformTypeForIdentifier: (NSString *)conforms];
    parents = (parentType != nil) ? @[parentType] : @[];
  }
  else {
    parents = @[];
  }

  return [[[UniformType alloc] initWithUniformTypeIdentifier: uti
                                                 description: descr
                                                     parents: parents] autorelease];
}

@end // @implementation UniformTypeInventory (PrivateMethods)
