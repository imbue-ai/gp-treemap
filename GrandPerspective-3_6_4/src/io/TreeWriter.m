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

#import "TreeWriter.h"

#import "DirectoryItem.h"
#import "CompoundItem.h"

#import "ApplicationError.h"

#import "TreeVisitingProgressTracker.h"
#import "TextOutput.h"

// Formatting string used in XML (RFC 3339)
NSString  *DateTimeFormat = @"yyyy'-'MM'-'dd'T'HH':'mm':'ss'Z'";

// Localized error messages
#define FAILED_TO_CREATE_FILE \
NSLocalizedString(@"Failed to create file", @"Error message")
#define FAILED_TO_CLOSE_FILE \
NSLocalizedString(@"Failed to close file", @"Error message")
#define FAILED_TO_WRITE \
NSLocalizedString(@"Failed to write to file", @"Error message")


@implementation TreeWriter

- (instancetype) init {
  if (self = [super init]) {
    abort = NO;
    error = nil;

    progressTracker = [[TreeVisitingProgressTracker alloc] init];
    textOutput = nil;
  }
  return self;
}

- (void) dealloc {
  [error release];

  [progressTracker release];

  [super dealloc];
}

- (BOOL) writeTree:(AnnotatedTreeContext *)tree toFile:(NSURL *)path options:(id)options {
  NSAssert(!textOutput, @"textOutput not nil");

  textOutput = [self newTextOutput: path];

  if (![textOutput open]) {
    error = [[ApplicationError alloc] initWithLocalizedDescription: FAILED_TO_CREATE_FILE];
  } else {
    [progressTracker startingTask];

    [self writeTree: tree options: options];

    if (error==nil) {
      if (![textOutput flush]) {
        error = [[ApplicationError alloc] initWithLocalizedDescription: FAILED_TO_WRITE];
      } else if (![textOutput close]) {
        error = [[ApplicationError alloc] initWithLocalizedDescription: FAILED_TO_CLOSE_FILE];
      }
    }

    [progressTracker finishedTask];
  }

  [textOutput release];

  return (error==nil) && !abort;
}

- (void) writeTree:(AnnotatedTreeContext *)tree options:(id)options {
  NSAssert(NO, @"This method should be overridden.");
}

- (void) abort {
  abort = YES;
}

- (BOOL) aborted {
  return (error==nil) && abort;
}

- (NSError *)error {
  return error;
}

- (NSDictionary *)progressInfo {
  return [progressTracker progressInfo];
}

@end // @implementation TreeWriter


@implementation TreeWriter (ProtectedMethods)

+ (NSDateFormatter *)nsTimeFormatter {
  static NSDateFormatter *timeFmt = nil;
  if (timeFmt == nil) {
    timeFmt = [[NSDateFormatter alloc] init];
    timeFmt.locale = [NSLocale localeWithLocaleIdentifier: @"en_US_POSIX"];
    timeFmt.dateFormat = DateTimeFormat;
    timeFmt.timeZone = [NSTimeZone timeZoneForSecondsFromGMT: 0];
  }
  return timeFmt;
}

+ (NSString *)stringForTime:(CFAbsoluteTime)time {
  if (time == 0) {
    return nil;
  } else {
    return [self.nsTimeFormatter stringFromDate:
            [NSDate dateWithTimeIntervalSinceReferenceDate: time]];
  }
}

- (TextOutput *)newTextOutput:(NSURL *)path {
  return [[TextOutput alloc] initWithPath: path];
}

- (void) appendString:(NSString *)s {
  if (error != nil) {
    // Don't write anything when an error has occurred.
    //
    // Note: Still keep writing if "only" the abort flag is set. This way, an
    // external "abort" of the write operation still results in valid XML.
    return;
  }

  if (![textOutput appendString: s]) {
    error = [[ApplicationError alloc] initWithLocalizedDescription: FAILED_TO_WRITE];

    abort = YES;
  }
}

- (void) dumpItemContents:(Item *)item {
  if (abort || item == nil) {
    return;
  }

  if (item.isVirtual) {
    [self dumpItemContents: ((CompoundItem *)item).first];
    [self dumpItemContents: ((CompoundItem *)item).second];
  }
  else {
    FileItem  *fileItem = (FileItem *)item;

    if (fileItem.isPhysical) {
      // Only include actual files.

      if (fileItem.isDirectory) {
        [self appendFolderElement: (DirectoryItem *)fileItem];
      }
      else {
        [self appendFileElement: (PlainFileItem *)fileItem];
      }
    }
  }
}

- (void) appendFolderElement:(DirectoryItem *)dirItem {
  NSAssert(NO, @"This method should be overridden.");
}

- (void) appendFileElement:(FileItem *)fileItem {
  NSAssert(NO, @"This method should be overridden.");
}

@end // @implementation TreeWriter (ProtectedMethods)
